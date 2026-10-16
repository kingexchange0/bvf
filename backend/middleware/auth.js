const jwt = require('jsonwebtoken');
const User = require('../models/User');

if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set — using the hardcoded development fallback. Set JWT_SECRET in backend/.env.');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'crestcoin_secret_key_2024';

// Verify JWT token
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ success: false, message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Token is not valid' });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Account has been deactivated' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token is not valid' });
  }
};

// Verify admin role
const adminOnly = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
  } catch (error) {
    res.status(403).json({ success: false, message: 'Admin access required' });
  }
};

// Require completed identity verification (KYC) for money-movement features
const requireKyc = (req, res, next) => {
  if (req.user.kycStatus !== 'verified') {
    return res.status(403).json({
      success: false,
      message: 'Complete identity verification (KYC) to access this feature.'
    });
  }
  next();
};

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
};

// Generate short-lived token for the email-OTP login step
const generateOtpToken = (userId) => {
  return jwt.sign({ id: userId, otp: true }, JWT_SECRET, { expiresIn: '10m' });
};

// Verify an OTP session token; returns decoded payload or null
const verifyOtpToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded && decoded.otp === true ? decoded : null;
  } catch (error) {
    return null;
  }
};

module.exports = { auth, adminOnly, requireKyc, generateToken, generateOtpToken, verifyOtpToken, JWT_SECRET };
