const express = require('express');
const router = express.Router();
const { auth, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');
const Investment = require('../models/Investment');
const Loan = require('../models/Loan');
const KYC = require('../models/KYC');
const Message = require('../models/Message');
const AdminLog = require('../models/AdminLog');
const { adjustBalance } = require('../utils/ledger');
const { sendEmail, sendEmailToUser, sendBroadcastToAll, getEmailStatus } = require('../utils/emailService');

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard stats
// @access  Private/Admin
router.get('/dashboard', auth, adminOnly, async (req, res) => {
  try {
    // User stats
    const totalUsers = await User.countDocuments({ role: 'user' });
    const newUsersToday = await User.countDocuments({
      role: 'user',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    // Transaction stats
    const totalDeposits = await Deposit.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalWithdrawals = await Withdrawal.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const pendingDeposits = await Deposit.countDocuments({ status: 'pending' });
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
    
    // Investment stats
    const activeInvestments = await Investment.countDocuments({ status: 'active' });
    const totalInvested = await Investment.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    // Loan stats
    const pendingLoans = await Loan.countDocuments({ status: 'pending' });
    const activeLoans = await Loan.countDocuments({ status: { $in: ['approved', 'active'] } });
    
    // KYC stats
    const pendingKYC = await KYC.countDocuments({ status: 'pending' });
    
    // Message stats
    const unreadMessages = await Message.countDocuments({ sender: 'user', isRead: false });
    
    // Recent users
    const recentUsers = await User.find({ role: 'user' })
      .select('name email balanceUSD createdAt')
      .sort({ createdAt: -1 })
      .limit(5);
    
    // Recent transactions
    const recentTransactions = await Transaction.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(5);
    
    res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          newUsersToday,
          totalDeposits: totalDeposits[0]?.total || 0,
          totalWithdrawals: totalWithdrawals[0]?.total || 0,
          pendingDeposits,
          pendingWithdrawals,
          activeInvestments,
          totalInvested: totalInvested[0]?.total || 0,
          pendingLoans,
          activeLoans,
          pendingKYC,
          unreadMessages
        },
        recentUsers,
        recentTransactions
      }
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Private/Admin
router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    
    let query = { role: 'user' };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await User.countDocuments(query);
    
    res.json({
      success: true,
      data: users,
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/users/:id
// @desc    Get user details
// @access  Private/Admin
router.get('/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Get user stats
    const deposits = await Deposit.find({ userId: user._id, status: 'approved' });
    const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);
    
    const withdrawals = await Withdrawal.find({ userId: user._id, status: 'approved' });
    const totalWithdrawals = withdrawals.reduce((sum, w) => sum + w.amount, 0);
    
    const investments = await Investment.find({ userId: user._id });
    const totalInvested = investments.reduce((sum, i) => sum + i.amount, 0);
    
    const loans = await Loan.find({ userId: user._id });
    
    const kyc = await KYC.findOne({ userId: user._id });

    // Full transaction history for the admin user page (includes hidden, flagged)
    const transactions = await Transaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json({
      success: true,
      data: {
        user,
        stats: {
          totalDeposits,
          totalWithdrawals,
          totalInvested,
          investmentCount: investments.length,
          loanCount: loans.length
        },
        kyc,
        investments,
        loans,
        transactions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/users/:id
// @desc    Update user
// @access  Private/Admin
router.put('/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, isActive, kycStatus } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (isActive !== undefined) user.isActive = isActive;
    if (kycStatus) user.kycStatus = kycStatus;
    
    await user.save();
    
    // Log action
    await AdminLog.create({
      adminId: req.user._id,
      action: 'UPDATE_USER',
      details: `Updated user ${user.email}`,
      targetUser: user._id
    });
    
    res.json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/users/:id/credit
// @desc    Credit user balance
// @access  Private/Admin
router.post('/users/:id/credit', auth, adminOnly, async (req, res) => {
  try {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const result = await adjustBalance(user._id, parseFloat(amount), req.user._id, description || 'Admin credit');
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.reason === 'reason_required' ? 'A reason is required' : 'Adjustment failed' });
    }

    res.json({
      success: true,
      message: `Successfully credited $${amount} to user`,
      data: { newBalance: result.balance }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/users/:id/debit
// @desc    Debit user balance
// @access  Private/Admin
router.post('/users/:id/debit', auth, adminOnly, async (req, res) => {
  try {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const result = await adjustBalance(user._id, -parseFloat(amount), req.user._id, description || 'Admin debit');
    if (!result.ok) {
      const message = result.reason === 'reason_required' ? 'A reason is required'
        : result.reason === 'insufficient_funds' ? 'User has insufficient balance'
        : 'Adjustment failed';
      return res.status(400).json({ success: false, message });
    }

    res.json({
      success: true,
      message: `Successfully debited $${amount} from user`,
      data: { newBalance: result.balance }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/users/:id/generate-history
// @desc    Generate realistic demo ledger history for a user (admin tool).
//          History entries are tagged (generated:true) so they can be purged
//          later; they never change balances. Re-running replaces the
//          previously generated set.
// @access  Private/Admin
router.post('/users/:id/generate-history', auth, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const months = Math.min(Math.max(parseInt(req.body.months, 10) || 12, 1), 36);
    const count = Math.min(Math.max(parseInt(req.body.count, 10) || 30, 5), 200);

    // Replace any previously generated history for a clean re-run.
    await Transaction.deleteMany({ userId: user._id, generated: true });

    const now = Date.now();
    const span = months * 30 * 24 * 60 * 60 * 1000;
    const round2 = (n) => Math.round(n * 100) / 100;
    const between = (min, max) => round2(min + Math.random() * (max - min));
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const randDate = () => new Date(now - Math.floor(Math.random() * span));

    const templates = [
      { type: 'deposit', status: 'approved', w: 4, amount: () => between(200, 5000),
        description: () => pick(['Bank transfer deposit', 'ACH deposit received', 'Crypto deposit (BTC) verified']) },
      { type: 'invest', status: 'completed', w: 3, amount: () => between(500, 20000),
        description: () => pick(['Investment subscription: Balanced Yield', 'Investment subscription: Starter Growth', 'Investment subscription: Wealth Builder']) },
      { type: 'investment_return', status: 'completed', w: 3, amount: () => between(600, 26000),
        description: () => pick(['Investment maturity: principal + profit credited', 'Investment plan matured']) },
      { type: 'transfer', status: 'completed', w: 2, amount: () => between(50, 1500),
        description: () => pick(['Transfer from Checking to Savings', 'Transfer from Savings to Checking']) },
      { type: 'withdraw', status: 'approved', w: 2, amount: () => between(100, 3000),
        description: () => pick(['Withdrawal to external bank account', 'BTC withdrawal processed']) },
      { type: 'referral_bonus', status: 'completed', w: 1, amount: () => 50,
        description: () => 'Referral bonus' }
    ];
    const bag = templates.flatMap((t) => Array(t.w).fill(t));

    const docs = [];
    for (let i = 0; i < count; i++) {
      const t = pick(bag);
      docs.push({
        userId: user._id,
        type: t.type,
        amount: t.amount(),
        status: t.status,
        description: t.description(),
        referenceId: `BV-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        generated: true,
        createdAt: randDate()
      });
    }
    docs.sort((a, b) => a.createdAt - b.createdAt);
    await Transaction.insertMany(docs);

    await AdminLog.create({
      adminId: req.user._id,
      action: 'GENERATE_HISTORY',
      details: `Generated ${docs.length} demo history entries spanning ${months} month(s)`,
      targetUser: user._id
    });

    res.json({
      success: true,
      message: `Generated ${docs.length} history entries for ${user.name}`,
      data: { count: docs.length, months }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/admin/users/:id/generated-history
// @desc    Remove generated demo history for a user
// @access  Private/Admin
router.delete('/users/:id/generated-history', auth, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const result = await Transaction.deleteMany({ userId: user._id, generated: true });
    await AdminLog.create({
      adminId: req.user._id,
      action: 'PURGE_GENERATED_HISTORY',
      details: `Removed ${result.deletedCount} generated history entries`,
      targetUser: user._id
    });
    res.json({ success: true, message: `Removed ${result.deletedCount} generated entries`, data: { removed: result.deletedCount } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/logs
// @desc    Get admin logs
// @access  Private/Admin
router.get('/logs', auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    
    const logs = await AdminLog.find()
      .populate('adminId', 'name email')
      .populate('targetUser', 'name email')
      .sort({ timestamp: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await AdminLog.countDocuments();
    
    res.json({
      success: true,
      data: logs,
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/transactions
// @desc    Get all transactions (admin view)
// @access  Private/Admin
router.get('/transactions', auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 20, userId, type, status, dateRange } = req.query;
    
    let query = {};
    
    // Filter by user
    if (userId) {
      query.userId = userId;
    }
    
    // Filter by type
    if (type) {
      query.type = type;
    }
    
    // Filter by status
    if (status) {
      query.status = status;
    }
    
    // Filter by date range
    if (dateRange) {
      const now = new Date();
      let startDate;
      
      switch(dateRange) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'week':
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case 'month':
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
      }
      
      if (startDate) {
        query.createdAt = { $gte: startDate };
      }
    }
    
    // Get transactions with user info
    const transactions = await Transaction.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Transaction.countDocuments(query);
    
    // Get stats
    const totalCount = await Transaction.countDocuments();
    const pendingCount = await Transaction.countDocuments({ status: 'pending' });
    const totalVolume = await Transaction.aggregate([
      { $match: { status: { $in: ['approved', 'completed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    res.json({
      success: true,
      data: transactions,
      stats: {
        totalCount,
        pendingCount,
        totalVolume: totalVolume[0]?.total || 0
      },
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('Admin transactions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/email/broadcast
// @desc    Send email broadcast to all users
// @access  Private/Admin
router.post('/email/broadcast', auth, adminOnly, async (req, res) => {
  try {
    const { subject, html, text } = req.body;
    
    if (!subject || !html) {
      return res.status(400).json({ success: false, message: 'Subject and HTML content are required' });
    }
    
    const result = await sendBroadcastToAll(subject, html, text);
    
    // Log action
    await AdminLog.create({
      adminId: req.user._id,
      action: 'EMAIL_BROADCAST_ALL',
      details: `Sent email broadcast to all users: ${subject}`
    });
    
    res.json({
      success: true,
      message: `Email broadcast sent. ${result.results.sent} sent, ${result.results.failed} failed`,
      data: result.results
    });
  } catch (error) {
    console.error('Email broadcast error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/email/send-user
// @desc    Send email to a specific user
// @access  Private/Admin
router.post('/email/send-user', auth, adminOnly, async (req, res) => {
  try {
    const { userId, subject, html, text } = req.body;
    
    if (!userId || !subject || !html) {
      return res.status(400).json({ success: false, message: 'User ID, subject and HTML content are required' });
    }
    
    const result = await sendEmailToUser(userId, subject, html, text);
    
    if (result.success) {
      // Log action
      await AdminLog.create({
        adminId: req.user._id,
        action: 'EMAIL_SEND_USER',
        details: `Sent email to user ${userId}: ${subject}`,
        targetUser: userId
      });
      
      res.json({
        success: true,
        message: 'Email sent successfully',
        data: { messageId: result.messageId }
      });
    } else {
      res.status(400).json({ success: false, message: result.error || 'Failed to send email' });
    }
  } catch (error) {
    console.error('Send email to user error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/email/status
// @desc    Email provider status (no secrets)
// @access  Private/Admin
router.get('/email/status', auth, adminOnly, async (req, res) => {
  try {
    res.json({ success: true, data: getEmailStatus() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/email/test
// @desc    Test email configuration
// @access  Private/Admin
router.post('/email/test', auth, adminOnly, async (req, res) => {
  try {
    const { testEmail, to } = req.body;
    const recipient = (to || testEmail || '').trim();

    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(400).json({ success: false, message: 'A valid test email address is required' });
    }

    const status = getEmailStatus();
    const result = await sendEmail(
      recipient,
      'BrightVale Finance - Email Test',
      '<p>This is a test email from BrightVale Finance. If you received it, your email provider is configured correctly.</p>',
      'This is a test email from BrightVale Finance. If you received it, your email provider is configured correctly.'
    );

    if (result.success) {
      res.json({ success: true, message: `Test email sent via ${status.provider}`, data: { provider: status.provider } });
    } else {
      res.status(400).json({ success: false, message: result.error || 'Failed to send test email' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
