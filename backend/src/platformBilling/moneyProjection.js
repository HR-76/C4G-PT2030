'use strict';

const { decimal, fail } = require('./contracts');

function money(value) { return decimal(String(value), { allowZero: true }); }
function moneyUnits(value) {
  const [whole, fraction = ''] = money(value).split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
function sameMoney(left, right) { return moneyUnits(left) === moneyUnits(right); }
function adjustedTotal(document, adjustments) {
  return moneyUnits(document.total) + moneyUnits(adjustments?.debit_amount ?? '0')
    - moneyUnits(adjustments?.credit_amount ?? '0');
}
function paymentProjection(row) {
  if (!row) fail('BILLING_DOCUMENT_NOT_FOUND');
  const paidAmount = money(row.paid_amount), balanceAmount = money(row.balance_amount);
  const paymentCount = Number(row.payment_count), reversalCount = Number(row.reversal_count);
  let paymentState = 'PARTIALLY_PAID';
  if (balanceAmount === '0') paymentState = 'PAID';
  else if (paidAmount === '0') paymentState = paymentCount > 0 && reversalCount > 0 ? 'REVERSED' : 'UNPAID';
  return Object.freeze({ total: money(row.total), paidAmount, balanceAmount, paymentState });
}
module.exports = { money, moneyUnits, sameMoney, adjustedTotal, paymentProjection };
