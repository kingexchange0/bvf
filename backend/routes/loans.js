const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { auth, adminOnly, requireKyc } = require('../middleware/auth');
const Loan = require('../models/Loan');
const LoanPlan = require('../models/LoanPlan');
const Notification = require('../models/Notification');
const { sendTransactionEmail } = require('../utils/emailService');
const { creditBalance, debitBalance, hasCompletedTx } = require('../utils/ledger');

// @route   POST /api/loans/request
// @desc    Request a new loan
// @access  Private
router.post('/request', auth, requireKyc, async (req, res) => {
  try {
    const { planId, amount, purpose } = req.body;
    
    // Validate plan
    const plan = await LoanPlan.findById(planId);
    if (!plan || !plan.isActive) {
      return res.status(404).json({ success: false, message: 'Loan plan not found' });
    }
    
    // Validate amount
    const loanAmount = parseFloat(amount);
    if (loanAmount < plan.minAmount || loanAmount > plan.maxAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Amount must be between $${plan.minAmount} and $${plan.maxAmount}` 
      });
    }
    
    // Check if user has pending/active loans
    const existingLoan = await Loan.findOne({
      userId: req.user._id,
      status: { $in: ['pending', 'approved', 'active'] }
    });
    
    if (existingLoan) {
      return res.status(400).json({ 
        success: false, 
        message: 'You already have an active or pending loan' 
      });
    }
    
    // Calculate repayment
    const interestAmount = (loanAmount * plan.interestRate) / 100;
    const totalRepayment = loanAmount + interestAmount;
    const monthlyPayment = totalRepayment / plan.durationMonths;
    
    // Create loan request
    const loan = await Loan.create({
      userId: req.user._id,
      planId: plan._id,
      planName: plan.name,
      amount: loanAmount,
      interestRate: plan.interestRate,
      durationMonths: plan.durationMonths,
      totalRepayment,
      monthlyPayment,
      purpose: purpose || ''
    });
    
    // Create notification for user
    await Notification.create({
      userId: req.user._id,
      title: 'Loan Request Submitted',
      message: `Your loan request of $${loanAmount} is pending approval`,
      type: 'info'
    });
    
    res.status(201).json({
      success: true,
      message: 'Loan request submitted successfully',
      data: loan
    });
  } catch (error) {
    console.error('Loan request error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/loans
// @desc    Get user loans
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    let query = { userId: req.user._id };
    if (status) query.status = status;
    
    const loans = await Loan.find(query)
      .populate('planId', 'name interestRate durationMonths')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Loan.countDocuments(query);
    
    res.json({
      success: true,
      data: loans,
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

// @route   GET /api/admin/loans
// @desc    Get all loans (admin)
// @access  Private/Admin
router.get('/admin/all', auth, adminOnly, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    let query = {};
    if (status) query.status = status;
    
    const loans = await Loan.find(query)
      .populate('userId', 'name email')
      .populate('planId', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Loan.countDocuments(query);
    
    // Calculate totals
    const totalActive = await Loan.aggregate([
      { $match: { status: { $in: ['approved', 'active'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalPending = await Loan.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    res.json({
      success: true,
      data: loans,
      stats: {
        totalActive: totalActive[0]?.total || 0,
        totalPending: totalPending[0]?.total || 0,
        pendingCount: await Loan.countDocuments({ status: 'pending' })
      },
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

// @route   PUT /api/admin/loans/:id/approve
// @desc    Approve a loan
// @access  Private/Admin
router.put('/admin/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;
    
    const loan = await Loan.findById(id);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan not found' });
    }
    
    if (loan.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Loan already processed' });
    }
    
    loan.status = 'active';
    loan.approvedAt = new Date();
    if (adminNote) loan.adminNote = adminNote;
    await loan.save();

    // Disburse loan amount to user balance (idempotent ledger credit)
    await creditBalance(loan.userId, loan.amount, {
      type: 'loan',
      description: `Loan approved - ${loan.planName}`,
      referenceId: String(loan._id) + ':disbursement'
    });

    await Notification.create({
      userId: loan.userId,
      title: 'Loan Approved',
      message: `Your loan of $${loan.amount} has been approved`,
      type: 'success'
    });
    
    sendTransactionEmail(loan.userId, { title: 'Loan approved', amount: loan.amount, description: loan.planName + ' disbursed to your checking balance', status: 'disbursed' });

    res.json({
      success: true,
      message: 'Loan approved successfully',
      data: loan
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/loans/:id/decline
// @desc    Decline a loan
// @access  Private/Admin
router.put('/admin/:id/decline', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;
    
    const loan = await Loan.findById(id);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan not found' });
    }
    
    if (loan.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Loan already processed' });
    }
    
    loan.status = 'declined';
    if (adminNote) loan.adminNote = adminNote;
    await loan.save();
    
    // Create notification
    await Notification.create({
      userId: loan.userId,
      title: 'Loan Declined',
      message: `Your loan request of $${loan.amount} has been declined. Reason: ${adminNote || 'No reason provided'}`,
      type: 'error'
    });
    
    sendTransactionEmail(loan.userId, { title: 'Loan application declined', amount: loan.amount, description: 'Your loan application was declined' + (adminNote ? ': ' + adminNote : ''), status: 'declined' });

    res.json({
      success: true,
      message: 'Loan declined successfully',
      data: loan
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/loans/:id/repay
// @desc    Repay part or all of an active loan
// @access  Private
router.post('/:id/repay', auth, async (req, res) => {
  try {
    const { amount, idempotencyKey } = req.body;
    const repayAmount = parseFloat(amount);

    if (!repayAmount || repayAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid repayment amount' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan not found' });
    }

    if (loan.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (!['approved', 'active'].includes(loan.status)) {
      return res.status(400).json({ success: false, message: 'Loan is not active' });
    }

    const remaining = loan.totalRepayment - (loan.repaidAmount || 0);
    if (repayAmount > remaining) {
      return res.status(400).json({ success: false, message: `Repayment exceeds remaining balance of $${remaining.toFixed(2)}` });
    }

    // Idempotency: a replayed key returns success without mutating anything
    const referenceId = idempotencyKey
      ? String(idempotencyKey)
      : String(loan._id) + ':repay:' + new mongoose.Types.ObjectId();

    if (idempotencyKey && await hasCompletedTx(req.user._id, 'loan_repayment', referenceId)) {
      return res.json({ success: true, message: 'Repayment already processed', data: loan });
    }

    const debit = await debitBalance(req.user._id, repayAmount, {
      type: 'loan_repayment',
      description: `Loan repayment - ${loan.planName}`,
      referenceId
    });

    if (!debit.ok) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    loan.repaidAmount = (loan.repaidAmount || 0) + repayAmount;
    if (loan.repaidAmount >= loan.totalRepayment) {
      loan.status = 'completed';
    }
    await loan.save();

    await Notification.create({
      userId: req.user._id,
      title: 'Loan Repayment',
      message: `You repaid $${repayAmount.toFixed(2)} on your ${loan.planName} loan${loan.status === 'completed' ? '. Loan fully repaid!' : ''}`,
      type: 'success'
    });

    sendTransactionEmail(req.user._id, { title: 'Loan repayment received', amount: repayAmount, description: loan.planName, status: 'completed' });

    res.json({
      success: true,
      message: 'Repayment successful',
      data: { loan, newBalance: debit.balance }
    });
  } catch (error) {
    console.error('Loan repayment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
