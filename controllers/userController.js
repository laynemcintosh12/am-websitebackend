const pool = require('../config/db');
const { 
  createUser, 
  authenticateUser, 
  getUserByEmail, 
  updateUser, 
  deleteUser,
  getUserById,
  getUserByName
} = require('../models/userModel');
const { hashPassword, verifyPassword, generateToken } = require('../services/authService');
const { AppError } = require('../utils/error');
const { sendPasswordResetEmail } = require('../utils/email');
const crypto = require('crypto');

/**
 * OPTIMIZED: Normalize email to lowercase for consistency
 */
const normalizeEmail = (email) => {
  return email ? email.toLowerCase().trim() : '';
};

/**
 * OPTIMIZED: Register a new user with email normalization
 */
const registerUser = async (req, res, next) => {
  try {
    console.log('Registering user with data:', req.body);
    
    const { 
      name, 
      email, 
      password, 
      role, 
      permissions, 
      phone, 
      hire_date,
      yearly_goal
    } = req.body;

    // Normalize email to lowercase
    const normalizedEmail = normalizeEmail(email);
    
    if (!normalizedEmail) {
      throw new AppError('Valid email is required', 400);
    }

    // Check if user already exists (with normalized email)
    const existingUser = await getUserByEmail(normalizedEmail);
    if (existingUser) {
      throw new AppError('User already exists', 400);
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Parse date and number explicitly
    const parsedHireDate = hire_date ? new Date(hire_date) : null;
    const parsedYearlyGoal = Number(yearly_goal || 50000.00);

    // Validate name
    if (!name || name.trim().length < 2) {
      throw new AppError('Valid name is required', 400);
    }

    // Create the user with normalized email
    const user = await createUser(
      name.trim(), 
      normalizedEmail, 
      hashedPassword, 
      role, 
      permissions, 
      phone, 
      parsedHireDate,
      parsedYearlyGoal
    );

    res.status(201).json({ message: 'User registered successfully', user });
  } catch (error) {
    console.error('Error in registerUser:', error);
    next(error);
  }
};

/**
 * OPTIMIZED: Login with email normalization and better error handling
 */
const loginUser = async (req, res, next) => {
  try {
    const { email, password, token } = req.body;

    let user;

    if (token) {
      // Authenticate using the reset token
      const result = await pool.query(
        'SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()',
        [token]
      );
      user = result.rows[0];

      if (!user) {
        throw new AppError('Invalid or expired reset token', 400);
      }

      // Clear the reset token after successful login
      await pool.query(
        'UPDATE users SET reset_password_token = NULL, reset_password_expires = NULL WHERE id = $1',
        [user.id]
      );
    } else {
      if (!email || !password) {
        throw new AppError('Email and password are required', 400);
      }

      // Normalize email before authentication
      const normalizedEmail = normalizeEmail(email);
      
      // Authenticate using normalized email and password
      user = await authenticateUser(normalizedEmail, password);
    }

    // Generate a JWT token for the user
    const jwtToken = generateToken(user.id);

    res.status(200).json({
      message: 'Login successful',
      token: jwtToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email, // This will be the normalized (lowercase) email from DB
        role: user.role,
        permissions: user.permissions,
        yearly_goal: user.yearly_goal,
      },
    });
  } catch (error) {
    console.error('Error authenticating user:', error);
    next(error);
  }
};

/**
 * OPTIMIZED: Get user details with email normalization
 */
const getUserDetails = async (req, res, next) => {
  try {
    console.log('Fetching user details...', req.query);
    const { email, id, name } = req.query;

    if (!email && !id && !name) {
      return res.status(400).json({ error: 'You must provide either email, id, or name to fetch user details' });
    }

    let user;

    if (email) {
      // Normalize email for lookup
      const normalizedEmail = normalizeEmail(email);
      user = await getUserByEmail(normalizedEmail);
    } else if (id) {
      user = await getUserById(id);
    } else if (name) {
      user = await getUserByName(name);
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

/**
 * OPTIMIZED: Update user details with email normalization
 */
const updateUserDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Normalize email if it's being updated
    if (updates.email) {
      updates.email = normalizeEmail(updates.email);
      
      // Check if the new email already exists (excluding current user)
      const existingUser = await getUserByEmail(updates.email);
      if (existingUser && existingUser.id !== parseInt(id)) {
        throw new AppError('Email already exists', 400);
      }
    }

    const updatedUser = await updateUser(id, updates);
    if (!updatedUser) {
      throw new AppError('User not found', 404);
    }

    res.status(200).json({ message: 'User updated successfully', updatedUser });
  } catch (error) {
    next(error);
  }
};

/**
 * OPTIMIZED: Update password with better validation
 */
const updatePassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current password and new password are required', 400);
    }

    if (newPassword.length < 6) {
      throw new AppError('New password must be at least 6 characters long', 400);
    }

    // Get user from database
    const user = await getUserById(id);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify current password
    const isPasswordValid = await verifyPassword(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new AppError('Current password is incorrect', 400);
    }

    // Hash the new password
    const hashedPassword = await hashPassword(newPassword);

    // Update the password in database
    await updateUser(id, { password: hashedPassword });

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * OPTIMIZED: Forgot password with email normalization
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    // Normalize email for lookup
    const normalizedEmail = normalizeEmail(email);

    // Get user from database
    const user = await getUserByEmail(normalizedEmail);
    if (!user) {
      // Return same message even if user doesn't exist (security)
      return res.status(200).json({ message: 'If the email exists, a reset link has been sent.' });
    }

    // Generate reset token and expiration
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetPasswordExpires = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

    // Store reset token in database
    await updateUser(user.id, {
      reset_password_token: resetToken,
      reset_password_expires: resetPasswordExpires
    });

    // Send email with reset token (use normalized email)
    await sendPasswordResetEmail(normalizedEmail, resetToken);

    res.status(200).json({ message: 'If the email exists, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
};

/**
 * OPTIMIZED: Reset password with better validation
 */
const resetPassword = async (req, res, next) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      throw new AppError('Reset token and new password are required', 400);
    }

    if (newPassword.length < 6) {
      throw new AppError('New password must be at least 6 characters long', 400);
    }

    console.log('Reset token:', resetToken);

    // Find the user by reset token
    const result = await pool.query(
      'SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()',
      [resetToken]
    );
    const user = result.rows[0];

    console.log('User found for reset token:', user);
    if (!user) {
      throw new AppError('Invalid or expired reset token', 400);
    }

    // Hash the new password
    const hashedPassword = await hashPassword(newPassword);

    // Update the user's password and clear the reset token
    await pool.query(
      'UPDATE users SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2',
      [hashedPassword, user.id]
    );

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error in resetPassword:', error);
    next(error);
  }
};

/**
 * OPTIMIZED: Delete user with better validation
 */
const deleteUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(parseInt(id))) {
      throw new AppError('Valid user ID is required', 400);
    }

    const deletedUser = await deleteUser(id);
    if (!deletedUser) {
      throw new AppError('User not found', 404);
    }

    res.status(200).json({ message: 'User deleted successfully', deletedUser });
  } catch (error) {
    next(error);
  }
};

/**
 * OPTIMIZED: Get user details by ID with better error handling
 */
const getUserDetailsById = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const query = `
      SELECT 
        u.id, u.name, u.email, u.role, u.permissions, u.phone, u.hire_date, u.yearly_goal, u.created_at,
        ub.current_balance, ub.total_commissions_earned, ub.total_payments_received
      FROM users u
      LEFT JOIN user_balance ub ON u.id = ub.user_id
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [userId]);
    if (!result.rows[0]) {
      throw new Error(`User not found with ID: ${userId}`);
    }
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    throw new Error(`Failed to fetch user by ID: ${error.message}`);
  }
};

/**
 * OPTIMIZED: Get user's commission summary with pagination
 */
const getUserCommissionSummary = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    
    if (!userId || isNaN(parseInt(userId))) {
      throw new AppError('Valid user ID is required', 400);
    }
    
    const query = `
      SELECT 
        cd.id as commission_id,
        cd.commission_amount,
        cd.build_date,
        cd.is_paid,
        c.customer_name,  
        c.total_job_price,
        c.initial_scope_price,
        ub.current_balance,
        ub.total_commissions_earned,
        ub.total_payments_received
      FROM commissions_due cd
      JOIN customers c ON cd.customer_id = c.id
      LEFT JOIN user_balance ub ON cd.user_id = ub.user_id
      WHERE cd.user_id = $1
      ORDER BY cd.build_date DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [userId, limit, offset]);
    
    // Get total count for pagination
    const countQuery = 'SELECT COUNT(*) FROM commissions_due WHERE user_id = $1';
    const countResult = await pool.query(countQuery, [userId]);
    
    res.json({
      commissions: result.rows,
      summary: {
        currentBalance: result.rows[0]?.current_balance || 0,
        totalCommissionsEarned: result.rows[0]?.total_commissions_earned || 0,
        totalPaymentsReceived: result.rows[0]?.total_payments_received || 0
      },
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * OPTIMIZED: Get all users with better performance
 */
const getAllUsersController = async (req, res, next) => {
  try {
    const { includeBalances = false } = req.query;
    
    let users;
    if (includeBalances === 'true') {
      // Include balance information when requested
      const query = `
        SELECT 
          u.id, u.name, u.email, u.role, u.permissions, u.phone, u.hire_date, u.yearly_goal, u.created_at,
          ub.current_balance, ub.total_commissions_earned, ub.total_payments_received
        FROM users u
        LEFT JOIN user_balance ub ON u.id = ub.user_id
        ORDER BY u.name ASC
      `;
      const result = await pool.query(query);
      users = result.rows;
    } else {
      users = await require('../models/userModel').getAllUsers();
    }
    
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserDetails,
  updateUserDetails,
  updatePassword,
  forgotPassword,
  resetPassword,
  deleteUserById,
  getUserDetailsById,
  getAllUsers: getAllUsersController,
  getUserCommissionSummary,
  normalizeEmail // Export for use in other modules
};