const express = require('express');
const router = express.Router();
const { auth, adminOnly, requireKyc } = require('../middleware/auth');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Settings = require('../models/Settings');
const { debitBalance, creditBalance, hasCompletedTx } = require('../utils/ledger');
const { sendTransactionEmail } = require('../utils/emailService');

// @route   POST /api/withdrawals
// @desc    Create a new withdrawal request
// @access  Private
router.post('/', auth, requireKyc, async (req, res) => {
  try {
    const { type, amount, walletAddress, bankDetails } = req.body;
    
    const settings = await Settings.findOne();
    const minWithdrawal = settings?.minimumWithdrawal || 100;
    
    if (!amount || amount < minWithdrawal) {
      return res.status(400).json({ 
        success: false, 
        message: `Minimum withdrawal amount is $${minWithdrawal}` 
      });
    }
    
    // Validate withdrawal method
    if (type === 'btc' && !walletAddress) {
      return res.status(400).json({ success: false, message: 'BTC wallet address is required' });
    }

    if (type === 'bank' && (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankName)) {
      return res.status(400).json({ success: false, message: 'Bank details are required' });
    }

    // Create the withdrawal record first so the ledger entry can reference it
    const withdrawal = await Withdrawal.create({
      userId: req.user._id,
      type,
      amount: parseFloat(amount),
      walletAddress: type === 'btc' ? walletAddress : '',
      bankDetails: type === 'bank' ? bankDetails : {}
    });

    // Atomically debit the balance; fails if funds are insufficient
    const debit = await debitBalance(req.user._id, parseFloat(amount), {
      type: 'withdraw',
      description: `${type.toUpperCase()} Withdrawal`,
      referenceId: String(withdrawal._id) + ':debit'
    });

    if (!debit.ok) {
      await Withdrawal.deleteOne({ _id: withdrawal._id });
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    
    // Create transaction record (pending â€” mirrors the withdrawal status)
    await Transaction.create({
      userId: req.user._id,
      type: 'withdraw',
      amount: parseFloat(amount),
      status: 'pending',
      description: `${type.toUpperCase()} Withdrawal`,
      referenceId: withdrawal._id
    });
    
    sendTransactionEmail(req.user._id, { title: 'Withdrawal request received', amount: parseFloat(amount), description: 'Your withdrawal is pending review', status: 'pending' });

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: withdrawal
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/withdrawals
// @desc    Get withdrawals (user gets own, admin gets all)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    
    let query = {};
    
    if (req.user.role !== 'admin') {
      query.userId = req.user._id;
    }
    
    if (status) query.status = status;
    
    const withdrawals = await Withdrawal.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Withdrawal.countDocuments(query);
    
    res.json({
      success: true,
      data: withdrawals,
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

// @route   PUT /api/admin/withdrawals/:id/approve
// @desc    Approve a withdrawal
// @access  Private/Admin
router.put('/admin/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;
    
    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }
    
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Withdrawal already processed' });
    }
    
    withdrawal.status = 'approved';
    if (adminNote) withdrawal.adminNote = adminNote;
    await withdrawal.save();
    
    // Update transaction status
    await Transaction.findOneAndUpdate(
      { referenceId: withdrawal._id },
      { status: 'approved' }
    );
    
    // Create notification
    await Notification.create({
      userId: withdrawal.userId,
      title: 'Withdrawal Approved',
      message: `Your withdrawal of $${withdrawal.amount} has been approved`,
      type: 'success'
    });
    
    sendTransactionEmail(withdrawal.userId, { title: 'Withdrawal approved', amount: withdrawal.amount, description: `${withdrawal.type.toUpperCase()} withdrawal`, status: 'approved' });

    res.json({
      success: true,
      message: 'Withdrawal approved successfully',
      data: withdrawal
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/withdrawals/:id/decline
// @desc    Decline a withdrawal
// @access  Private/Admin
router.put('/admin/:id/decline', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;
    
    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }
    
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Withdrawal already processed' });
    }
    
    withdrawal.status = 'declined';
    if (adminNote) withdrawal.adminNote = adminNote;
    await withdrawal.save();
    
    // Refund user balance (idempotent â€” only once per withdrawal)
    const refundRef = String(withdrawal._id) + ':refund';
    if (!(await hasCompletedTx(withdrawal.userId, 'withdraw_refund', refundRef))) {
      await creditBalance(withdrawal.userId, withdrawal.amount, {
        type: 'withdraw_refund',
        description: `Refund for declined withdrawal of $${withdrawal.amount}`,
        referenceId: refundRef
      });
    }
    
    // Update transaction status
    await Transaction.findOneAndUpdate(
      { referenceId: withdrawal._id },
      { status: 'declined' }
    );
    
    // Create notification
    await Notification.create({
      userId: withdrawal.userId,
      title: 'Withdrawal Declined',
      message: `Your withdrawal of $${withdrawal.amount} has been declined. Reason: ${adminNote || 'No reason provided'}`,
      type: 'error'
    });
    
    sendTransactionEmail(withdrawal.userId, { title: 'Withdrawal declined — funds returned', amount: withdrawal.amount, description: 'Your withdrawal was declined and funds returned to your balance', status: 'refunded' });

    res.json({
      success: true,
      message: 'Withdrawal declined successfully',
      data: withdrawal
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
