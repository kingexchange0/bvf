const express = require('express');
const router = express.Router();
const { auth, adminOnly } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const AdminLog = require('../models/AdminLog');

// @route   GET /api/transactions
// @desc    Get all transactions (admin) or user transactions
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status } = req.query;
    
    let query = {};
    
    // If user is not admin, only show their (non-hidden) transactions
    if (req.user.role !== 'admin') {
      query.userId = req.user._id;
      query.hidden = { $ne: true };
    }
    
    if (type) query.type = type;
    if (status) query.status = status;
    
    const transactions = await Transaction.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Transaction.countDocuments(query);
    
    res.json({
      success: true,
      data: transactions,
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

// @route   GET /api/transactions/user/:userId
// @desc    Get transactions for a specific user (admin only)
// @access  Private/Admin
router.get('/user/:userId', auth, adminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 100 } = req.query;
    
    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Transaction.countDocuments({ userId });
    
    res.json({
      success: true,
      data: transactions,
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

// @route   PUT /api/transactions/admin/:id/hide
// @desc    Hide a transaction from the user's transaction list
// @access  Private/Admin
router.put('/admin/:id/hide', auth, adminOnly, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    await Transaction.updateOne({ _id: transaction._id }, { $set: { hidden: true } });

    await AdminLog.create({
      adminId: req.user._id,
      action: 'hide_transaction',
      details: `Hid ${transaction.type} transaction ${transaction._id} of $${transaction.amount}`,
      targetUser: transaction.userId,
      ipAddress: req.ip || ''
    });

    res.json({ success: true, message: 'Transaction hidden' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/transactions/admin/:id/show
// @desc    Unhide a transaction (idempotent)
// @access  Private/Admin
router.put('/admin/:id/show', auth, adminOnly, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    await Transaction.updateOne({ _id: transaction._id }, { $set: { hidden: false } });

    await AdminLog.create({
      adminId: req.user._id,
      action: 'show_transaction',
      details: `Unhid ${transaction.type} transaction ${transaction._id} of $${transaction.amount}`,
      targetUser: transaction.userId,
      ipAddress: req.ip || ''
    });

    res.json({ success: true, message: 'Transaction unhidden' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/transactions/summary
// @desc    Get transaction summary (admin only)
// @access  Private/Admin
router.get('/summary/all', auth, adminOnly, async (req, res) => {
  try {
    const totalDeposits = await Transaction.aggregate([
      { $match: { type: 'deposit', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalWithdrawals = await Transaction.aggregate([
      { $match: { type: 'withdraw', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalInvestments = await Transaction.aggregate([
      { $match: { type: 'invest' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const pendingTransactions = await Transaction.countDocuments({ status: 'pending' });
    
    res.json({
      success: true,
      data: {
        totalDeposits: totalDeposits[0]?.total || 0,
        totalWithdrawals: totalWithdrawals[0]?.total || 0,
        totalInvestments: totalInvestments[0]?.total || 0,
        pendingTransactions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
