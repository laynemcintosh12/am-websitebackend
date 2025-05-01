const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/error');

const protectRoute = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      throw new AppError('Unauthorized access', 401);
    }

    const secretKey = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secretKey);

    req.user = decoded; // Attach user info to the request object
    next();
  } catch (error) {
    next(new AppError('Unauthorized access', 401));
  }
};

module.exports = { protectRoute };