const pool = require('../config/db');
const bcrypt = require('bcrypt');

// Create a new user
const createUser = async (name, email, hashedPassword, role, permissions, phone = null, hireDate = null, yearlyGoal = 50000.00) => {
  try {

    const query = `
      INSERT INTO users (
        name, email, password, role, permissions, phone, hire_date, yearly_goal, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) 
      RETURNING *
    `;

    const values = [
      name,
      email,
      hashedPassword,
      role,
      permissions,
      phone,
      hireDate instanceof Date ? hireDate : null,
      Number(yearlyGoal)
    ];


    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating user:', error);
    throw new Error(`Failed to create user: ${error.message}`);
  }
};

// Authenticate a user (verify email and password)
const authenticateUser = async (email, password) => {
  try {
    const user = await getUserByEmail(email);
    if (!user) {
      throw new Error('User not found');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error('Invalid password');
    }

    return user; // Return the user if authentication is successful
  } catch (error) {
    console.error('Error authenticating user:', error);
    throw new Error('Failed to authenticate user');
  }
};

// Get a user by email
const getUserByEmail = async (email) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by email:', error);
    throw new Error('Failed to fetch user by email');
  }
};

// Get a user by name
const getUserByName = async (name) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, permissions, phone, hire_date, created_at 
       FROM users 
       WHERE name ILIKE $1`, 
      [`%${name}%`]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by name:', error);
    throw new Error('Failed to fetch user by name');
  }
};

// Update a user
const updateUser = async (id, updates) => {
  try {
    // If no updates provided, just return the current user
    if (!updates || Object.keys(updates).length === 0) {
      const currentUser = await getUserById(id);
      return currentUser;
    }

    const fields = [];
    const values = [];
    let index = 1;

    // Filter out undefined or null values
    const validUpdates = Object.entries(updates).filter(([_, value]) => value !== undefined && value !== null);

    for (const [key, value] of validUpdates) {
      fields.push(`${key} = $${index}`);
      values.push(value);
      index++;
    }

    // If no valid updates, return current user
    if (fields.length === 0) {
      const currentUser = await getUserById(id);
      return currentUser;
    }

    values.push(id); // Add the user ID as the last parameter

    const query = `
      UPDATE users 
      SET ${fields.join(', ')}
      WHERE id = $${index} 
      RETURNING *`;


    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error updating user:', error);
    throw new Error(`Failed to update user: ${error.message}`);
  }
};

// Update the deleteUser function to handle team memberships
const deleteUser = async (id) => {
  const { removeUserFromAllTeams } = require('./teamModel');
  
  // First remove from all teams
  await removeUserFromAllTeams(id);
  
  // Then delete the user
  const query = 'DELETE FROM users WHERE id = $1 RETURNING *';
  const result = await pool.query(query, [id]);
  return result.rows[0];
};

// Get a user by ID
const getUserById = async (id) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    throw new Error('Failed to fetch user by ID');
  }
};

// Get all users
const getAllUsers = async () => {
  try {
    const query = `
      SELECT id, name, email, role, permissions, phone, hire_date, yearly_goal, created_at
      FROM users
      ORDER BY created_at DESC;
    `;
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('Error fetching all users:', error);
    throw new Error('Failed to fetch all users');
  }
};

// Add updatePassword function
const updatePassword = async (userId, hashedPassword) => {
  try {
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2 RETURNING id',
      [hashedPassword, userId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error updating password:', error);
    throw new Error('Failed to update password');
  }
};

// Add resetPasswordToken function
const updateResetToken = async (userId, token, expires) => {
  try {
    const result = await pool.query(
      'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3 RETURNING id',
      [token, expires, userId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error updating reset token:', error);
    throw new Error('Failed to update reset token');
  }
};

// Add createInitialUser function
const createInitialUser = async (userId) => {
  const query = `
    INSERT INTO users (id)
    VALUES ($1)
    ON CONFLICT (id) DO NOTHING
    RETURNING *;
  `;
  await pool.query(query, [userId]);
};

// Add getUserBalance function
const getUserBalance = async (userId) => {
  try {
    // First ensure user exists
    await createInitialUser(userId);

    // Then create or get balance
    const query = `
      INSERT INTO user_balance (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) 
      DO UPDATE SET
        last_updated = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  } catch (error) {
    console.error('Error in getUserBalance:', error);
    throw error;
  }
};

module.exports = {
  createUser,
  authenticateUser,
  getUserByEmail,
  getUserByName,
  updateUser,
  deleteUser,
  getUserById,
  getAllUsers, // Add the new function to exports
  updatePassword,
  updateResetToken,
  createInitialUser,
  getUserBalance
};