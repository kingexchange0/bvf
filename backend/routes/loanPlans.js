const express = require('express');
const router = express.Router();
const { auth, adminOnly } = require('../middleware/auth');
const LoanPlan = require('../models/LoanPlan');

// @route   GET /api/loan-plans
// @desc    Get all active loan plans (for users)
// @access  Public
router.get('/', async (req, res) => {
  try {
    const plans = await LoanPlan.find({ isActive: true })
      .sort({ maxAmount: 1 });
    
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/loan-plans/all
// @desc    Get all loan plans (admin only)
// @access  Private/Admin
router.get('/all', auth, adminOnly, async (req, res) => {
  try {
    const plans = await LoanPlan.find().sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/loan-plans
// @desc    Create a new loan plan
// @access  Private/Admin
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, interestRate, durationMonths, maxAmount, minAmount, description } = req.body;
    
    if (!name || !interestRate || !durationMonths || !maxAmount) {
      return res.status(400).json({ success: false, message: 'All required fields must be provided' });
    }
    
    const plan = await LoanPlan.create({
      name,
      interestRate,
      durationMonths,
      maxAmount,
      minAmount: minAmount || 100,
      description
    });
    
    res.status(201).json({
      success: true,
      message: 'Loan plan created successfully',
      data: plan
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/loan-plans/:id
// @desc    Update a loan plan
// @access  Private/Admin
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, interestRate, durationMonths, maxAmount, minAmount, description, isActive } = req.body;
    
    const plan = await LoanPlan.findByIdAndUpdate(
      id,
      { name, interestRate, durationMonths, maxAmount, minAmount, description, isActive },
      { new: true }
    );
    
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Loan plan not found' });
    }
    
    res.json({
      success: true,
      message: 'Loan plan updated successfully',
      data: plan
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/admin/loan-plans/:id
// @desc    Delete a loan plan
// @access  Private/Admin
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    
    const plan = await LoanPlan.findByIdAndDelete(id);
    
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Loan plan not found' });
    }
    
    res.json({
      success: true,
      message: 'Loan plan deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
