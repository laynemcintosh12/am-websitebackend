const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Hash a password
const hashPassword = async (password) => {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
};

// Verify a password
const verifyPassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

// Generate a JWT token
const generateToken = (userId, permissions) => {
  const secretKey = process.env.JWT_SECRET; // Replace with a secure secret in production
  return jwt.sign({ userId, permissions }, secretKey, { expiresIn: '1h' });
};

// Verify a JWT token
const verifyToken = (token) => {
  const secretKey = process.env.JWT_SECRET; // Replace with a secure secret in production
  try {
    return jwt.verify(token, secretKey);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};
module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
};