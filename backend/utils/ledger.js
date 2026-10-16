const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const AdminLog = require('../models/AdminLog');

// Run fn inside a MongoDB transaction when the deployment supports it
// (replica sets / Atlas). Falls back to fn(null) on standalone servers,
// where multi-document transactions are unsupported.
async function runWithTransaction(fn) {
  try {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  } catch (error) {
    if (error && (error.code === 20 || /Transaction/.test(error.message) || /replica set|transactions?.*not supported/i.test(error.message))) {
      console.warn('Transactions not supported by this MongoDB deployment; proceeding without one.');
      return await fn(null);
    }
    throw error;
  }
}

// Atomically credit a user balance and record the ledger entry.
async function creditBalance(userId, amount, { type, description, referenceId, session } = {}) {
  const user = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { balanceUSD: amount } },
    { new: true, session }
  );
  if (!user) {
    return { ok: false, reason: 'user_not_found', balance: null };
  }
  await Transaction.create([{
    userId,
    type,
    amount,
    status: 'completed',
    description: description || '',
    referenceId: referenceId || null
  }], { session });
  return { ok: true, balance: user.balanceUSD };
}

// Atomically debit a user balance. Fails with insufficient_funds when the
// balance would go negative — the balance update is the source of truth, the
// transaction record is the audit trail.
async function debitBalance(userId, amount, { type, description, referenceId, session } = {}) {
  const user = await User.findOneAndUpdate(
    { _id: userId, balanceUSD: { $gte: amount } },
    { $inc: { balanceUSD: -amount } },
    { new: true, session }
  );
  if (!user) {
    return { ok: false, reason: 'insufficient_funds', balance: null };
  }
  try {
    await Transaction.create([{
      userId,
      type,
      amount,
      status: 'completed',
      description: description || '',
      referenceId: referenceId || null
    }], { session });
  } catch (txError) {
    // Balance is source of truth; a failed audit write must not roll back funds.
    console.error('Failed to record debit transaction (balance already updated):', txError.message);
  }
  return { ok: true, balance: user.balanceUSD };
}

// Admin balance adjustment with a mandatory reason and audit log.
async function adjustBalance(userId, signedAmount, adminId, reason, { session } = {}) {
  if (!reason || !String(reason).trim()) {
    return { ok: false, reason: 'reason_required', balance: null };
  }
  const amount = Math.abs(signedAmount);
  let result;
  if (signedAmount >= 0) {
    result = await creditBalance(userId, amount, {
      type: 'admin_adjustment',
      description: `Admin adjustment: ${reason}`,
      session
    });
  } else {
    result = await debitBalance(userId, amount, {
      type: 'admin_adjustment',
      description: `Admin adjustment: ${reason}`,
      session
    });
  }
  if (result.ok) {
    await AdminLog.create([{
      adminId,
      action: signedAmount >= 0 ? 'CREDIT_USER' : 'DEBIT_USER',
      details: `${signedAmount >= 0 ? 'Credited' : 'Debited'} $${amount} (${reason})`,
      targetUser: userId
    }], { session });
  }
  return result;
}

// Check whether a completed ledger entry already exists for (user, type, referenceId).
async function hasCompletedTx(userId, type, referenceId) {
  const tx = await Transaction.findOne({ userId, type, referenceId, status: 'completed' });
  return !!tx;
}

module.exports = { runWithTransaction, creditBalance, debitBalance, adjustBalance, hasCompletedTx };
