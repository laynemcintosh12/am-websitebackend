const express = require('express');
const {
  registerUser,
  loginUser,
  getUserDetails,
  updateUserDetails,
  updatePassword,
  forgotPassword,
  resetPassword,
  deleteUserById,
  getAllUsers,
  getUserCommissionSummary
} = require('../controllers/userController');
const { protectRoute } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * Public Authentication Routes
 * These routes handle user authentication and password management
 * No authentication required
 */

// Register a new user in the system
// POST /api/users/register
// Required body: { 
//   name: string,
//   email: string (unique),
//   password: string,
//   role: string,
//   permissions: string,
//   phone?: string,
//   hireDate?: Date
// }
// Effects:
// - Creates new user record
// - Hashes password securely
// - Sets default yearly goal
router.post('/register', registerUser);

// Authenticate and login a user
// POST /api/users/login
// Required body: { email: string, password: string }
// OR { token: string } for reset token login
// Returns:
// - JWT token for authentication
// - User details (id, name, email, role, permissions)
router.post('/login', loginUser);

// Request password reset
// POST /api/users/forgot-password
// Required body: { email: string }
// Effects:
// - Generates reset token
// - Sets token expiration (2 hours)
// - Sends reset email to user
// Returns: Generic success message (security)
router.post('/forgot-password', forgotPassword);

// Reset password using token
// POST /api/users/reset-password
// Required body: { 
//   resetToken: string,
//   newPassword: string
// }
// Effects:
// - Verifies token validity and expiration
// - Updates password
// - Clears reset token
router.post('/reset-password', resetPassword);

/**
 * Protected Routes
 * These routes require valid JWT token
 * Access controlled by user role and permissions
 */

// Get all users in the system
// GET /api/users
// Returns: Array of user records with:
// - Basic user information
// - Role and permissions
// - Hire date and yearly goals
// - Excludes sensitive data (password, tokens)
router.get('/', getAllUsers);

// Get detailed user information
// GET /api/users/details
// Query params: email?, id?, or name? (at least one required)
// Returns: User record with:
// - All user details
// - Commission balance if applicable
// - Team associations
router.get('/details', getUserDetails);

// Update user information
// PUT /api/users/:id
// Required params: id
// Optional body: any user fields to update
// Effects:
// - Updates specified user fields
// - Maintains password hash if not changed
// - Updates timestamp
router.put('/:id', updateUserDetails);

// Update user password
// PUT /api/users/:id/password
// Required params: id
// Required body: {
//   currentPassword: string,
//   newPassword: string
// }
// Effects:
// - Verifies current password
// - Hashes and updates new password
router.put('/:id/password', updatePassword);

// Delete user from system
// DELETE /api/users/:id
// Required params: id
// Effects:
// - Removes user record
// - Maintains historical data
// - Updates related records (teams, customers)
router.delete('/:id', deleteUserById);

/**
 * User Commission Routes
 */

// Get user's commission summary
// GET /api/users/:userId/commission-summary
// Required params: userId
// Returns: {
//   balance: current commission balance,
//   history: array of commission records,
//   totals: commission and payment totals
// }
router.get('/:userId/commission-summary', getUserCommissionSummary);

module.exports = router;