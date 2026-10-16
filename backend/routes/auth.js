const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const User = require('../models/User');
const Settings = require('../models/Settings');
const Notification = require('../models/Notification');
const { auth, generateToken, generateOtpToken, verifyOtpToken } = require('../middleware/auth');
const { creditBalance } = require('../utils/ledger');
const {
  sendVerificationCode,
  sendPasswordReset,
  sendWelcomeEmail,
  sendLoginOtp,
  sendSecurityAlert
} = require('../utils/emailService');
const { generateUniqueAccountNumber } = require('../utils/seedProducts');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// Per-route limiters — each sensitive endpoint gets its own bucket so heavy
// use of one (e.g. login attempts) can never starve another (e.g. password resets).
const limiter = (max) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later.' }
});
const authLimiter = limiter(15);      // register / login / code verification
const forgotLimiter = limiter(5);     // password-reset requests
const resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later.' }
});

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Email verification only blocks access when explicitly enabled
// (EMAIL_VERIFICATION_REQUIRED=true). Default: accounts are usable immediately.
const verificationRequired = () => process.env.EMAIL_VERIFICATION_REQUIRED === 'true';

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    balanceUSD: user.balanceUSD,
    referralCode: user.referralCode,
    kycStatus: user.kycStatus,
    isEmailVerified: verificationRequired() ? user.isEmailVerified !== false : true,
    btcWalletAddress: user.btcWalletAddress,
    profilePicture: user.profilePicture,
    accountNumber: user.accountNumber
  };
}

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, referralCode, phone, country } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const existingUser = await User.findOne({ email: String(email).toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    let referredBy = null;
    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referralCode });
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    const user = new User({
      name,
      email,
      password,
      phone: phone || '',
      country: country || '',
      referredBy
    });

    // Email verification: 6-digit code, hashed, 15-min expiry
    const verificationCode = crypto.randomInt(100000, 1000000).toString();
    user.emailVerificationCodeHash = sha256(verificationCode);
    user.emailVerificationExpires = new Date(Date.now() + 15 * 60 * 1000);
    user.emailVerificationAttempts = 0;
    user.isEmailVerified = verificationRequired() ? false : true;
    user.accountNumber = await generateUniqueAccountNumber();

    await user.save();

    if (verificationRequired()) {
      // Send verification code; registration still succeeds if email delivery fails
      sendVerificationCode(user._id, verificationCode);
    } else {
      sendWelcomeEmail(user._id, user.accountNumber);
    }

    // Credit referrer $50 flat rate (ledger handles the audit entry)
    if (referrer) {
      const REFERRAL_BONUS = 50;
      await creditBalance(referrer._id, REFERRAL_BONUS, {
        type: 'referral_bonus',
        description: `Referral bonus for inviting ${user.name}`,
        referenceId: String(user._id) + ':referral'
      });

      await Notification.create({
        userId: referrer._id,
        title: 'Referral Bonus Earned!',
        message: `You earned $${REFERRAL_BONUS} for referring ${user.name}`,
        type: 'success'
      });
    }

    const settings = await Settings.findOne();
    if (!settings) {
      await Settings.create({});
    }

    await Notification.create({
      userId: user._id,
      title: settings?.welcomeNotificationTitle || 'Welcome to BrightVale Finance!',
      message: settings?.welcomeNotificationMessage || 'Thank you for joining BrightVale Finance. Start your investment journey today!',
      type: 'success'
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: verificationRequired()
        ? "User registered successfully. Please verify your email with the code we sent you."
        : "User registered successfully. Welcome to BrightVale Finance!",
      requiresVerification: verificationRequired(),
      data: { token, user: publicUser(user), requiresVerification: verificationRequired() }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/verify-email
// @desc    Verify email with 6-digit code (single-use, max 5 attempts)
// @access  Private
router.post('/verify-email', auth, authLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Verification code is required' });
    }

    const user = await User.findById(req.user._id);
    if (user.isEmailVerified !== false) {
      return res.json({ success: true, message: 'Email is already verified' });
    }
    if (!user.emailVerificationCodeHash || !user.emailVerificationExpires) {
      return res.status(400).json({ success: false, message: 'No verification code pending. Request a new one.' });
    }
    if (user.emailVerificationExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Verification code has expired. Request a new one.' });
    }
    if ((user.emailVerificationAttempts || 0) >= 5) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Request a new code.' });
    }

    user.emailVerificationAttempts = (user.emailVerificationAttempts || 0) + 1;

    if (sha256(code) !== user.emailVerificationCodeHash) {
      await user.save();
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    // Single-use: clear the code and mark verified
    user.isEmailVerified = true;
    user.emailVerificationCodeHash = null;
    user.emailVerificationExpires = null;
    user.emailVerificationAttempts = 0;
    await user.save();

    sendWelcomeEmail(user._id, user.accountNumber);

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/resend-verification
// @desc    Resend email verification code
// @access  Private
router.post('/resend-verification', auth, resendLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.isEmailVerified !== false) {
      return res.json({ success: true, message: 'Email is already verified' });
    }

    const verificationCode = crypto.randomInt(100000, 1000000).toString();
    user.emailVerificationCodeHash = sha256(verificationCode);
    user.emailVerificationExpires = new Date(Date.now() + 15 * 60 * 1000);
    user.emailVerificationAttempts = 0;
    await user.save();

    const r = await sendVerificationCode(user._id, verificationCode);
    if (!r || !r.success) {
      return res.status(500).json({ success: false, message: 'Email delivery is not configured. Contact support.' });
    }

    res.json({ success: true, message: 'Verification code sent' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/login
// @desc    Login user (lockout after 5 failed attempts for 15 min)
// @access  Public
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
      return res.status(429).json({ success: false, message: 'Too many failed attempts. Try again later.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
        user.failedLoginAttempts = 0;
      }
      await user.save();
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    // Optional email OTP step (LOGIN_OTP=true): password alone is not enough
    if (process.env.LOGIN_OTP === 'true') {
      const otp = crypto.randomInt(100000, 1000000).toString();
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      user.loginOtpHash = sha256(otp);
      user.loginOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
      user.loginOtpAttempts = 0;
      await user.save();

      const r = await sendLoginOtp(user._id, otp);
      if (!r || !r.success) {
        return res.status(500).json({ success: false, message: 'Email delivery is not configured. Contact support.' });
      }
      return res.json({
        success: true,
        message: 'Sign-in code sent to your email',
        requiresOtp: true,
        data: { otpToken: generateOtpToken(user._id) }
      });
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user._id);

    // Accounts created after email verification was introduced must verify
    // before gaining dashboard access (frontend shows the code step).
    if (user.isEmailVerified === false && verificationRequired()) {
      return res.json({
        success: true,
        message: 'Please verify your email to continue',
        requiresVerification: true,
        data: { token, user: publicUser(user) }
      });
    }

    res.json({
      success: true,
      message: 'Login successful',
      data: { token, user: publicUser(user) }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    res.json({ success: true, data: publicUser(req.user) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send password reset link (stores only a sha256 hash of the token)
// @access  Public
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await User.findOne({ email });

    // Always return success even if user not found (security)
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.'
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordTokenHash = sha256(resetToken);
    user.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    const resetUrl = (process.env.FRONTEND_URL || 'http://localhost:3000') + `/login.html?reset=${resetToken}`;

    const r = await sendPasswordReset(user._id, resetUrl);
    if (!r || !r.success) {
      return res.status(500).json({ success: false, message: 'Email delivery is not configured. Contact support.' });
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token and new password are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const user = await User.findOne({
      resetPasswordTokenHash: sha256(token),
      resetPasswordExpires: { $gt: new Date() }
    });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    user.password = newPassword; // pre-save hook hashes it
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpires = null;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    sendSecurityAlert(
      user._id,
      'Your password was changed',
      '<p>Your BrightVale Finance password was just changed. If this was not you, contact support immediately and reset your password.</p>'
    );

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/verify-login-otp
// @desc    Verify login OTP and issue a full session token
// @access  Public (requires otpToken from login)
router.post('/verify-login-otp', authLimiter, async (req, res) => {
  try {
    const { otpToken, code } = req.body;
    if (!otpToken || !code) {
      return res.status(400).json({ success: false, message: 'Sign-in code and session are required' });
    }

    const decoded = verifyOtpToken(otpToken);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Sign-in session expired. Please log in again.' });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.loginOtpHash || !user.loginOtpExpires) {
      return res.status(401).json({ success: false, message: 'No sign-in code pending. Please log in again.' });
    }
    if (user.loginOtpExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Sign-in code has expired. Please log in again.' });
    }
    if ((user.loginOtpAttempts || 0) >= 5) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Please log in again.' });
    }

    user.loginOtpAttempts = (user.loginOtpAttempts || 0) + 1;
    if (sha256(code) !== user.loginOtpHash) {
      await user.save();
      return res.status(400).json({ success: false, message: 'Invalid sign-in code' });
    }

    // Single-use: clear the OTP and complete the login
    user.loginOtpHash = null;
    user.loginOtpExpires = null;
    user.loginOtpAttempts = 0;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.lastLogin = new Date();
    await user.save();

    sendSecurityAlert(
      user._id,
      'New sign-in to your account',
      '<p>A sign-in to your BrightVale Finance account was completed using your email sign-in code.</p>'
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: { token: generateToken(user._id), user: publicUser(user) }
    });
  } catch (error) {
    console.error('Verify login OTP error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
