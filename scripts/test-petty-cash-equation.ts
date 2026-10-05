import * as fs from 'fs';
const envContent = fs.readFileSync('.env.local', 'utf-8');
envContent.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length > 0) {
        process.env[key.trim()] = vals.join('=').trim().replace(/^"|"$/g, '');
    }
});

import { getValidAccessToken } from '../app/lib/zoho-api';
import { listChartOfAccounts, listCashAccountTransactions } from '../app/lib/audit/accounts/zoho-read-source';

async function main() {
  try {
    const { token, store } = await getValidAccessToken();
    const orgId = store.organization_id || "774390949";

    const { accounts } = await listChartOfAccounts(orgId);
    
    // Filter for genuine cash accounts
    const cashAccounts = accounts.filter(a => a.account_type === 'cash');
    const pettyCash = cashAccounts.find(a => a.account_name.toLowerCase().includes('petty cash'));

    if (!pettyCash) {
       console.log("Petty cash account not found. All cash accounts:", cashAccounts.map(a => a.account_name));
       return;
    }

    console.log(`Found Petty Cash: ${pettyCash.account_name} (${pettyCash.account_id})`);

    // Fetch transactions for FY2025-26
    const { transactions } = await listCashAccountTransactions(orgId, pettyCash.account_id, {
        from_date: "2025-04-01",
        to_date: "2026-03-31"
    });

    console.log(`Total transactions fetched: ${transactions.length}`);

    // Determine direction semantics and test equation
    // Sort transactions chronologically
    transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.transaction_id.localeCompare(b.transaction_id));

    fs.writeFileSync('scratch/petty_cash_transactions.json', JSON.stringify(transactions, null, 2));

    let openingBalance = 0;
    let receipts = 0;
    let payments = 0;
    let transferIn = 0;
    let transferOut = 0;
    let unknown = 0;
    
    let lowestBalance = 0;
    let negativeTransactions = 0;

    let runningBal = undefined;

    // We can infer opening balance if first transaction has running_balance
    if (transactions.length > 0) {
       const firstTx = transactions[0];
       if (firstTx.running_balance !== undefined) {
           let amount = firstTx.amount || 0;
           if (firstTx.debit_or_credit === 'debit') {
               openingBalance = firstTx.running_balance - amount;
           } else if (firstTx.debit_or_credit === 'credit') {
               openingBalance = firstTx.running_balance + amount;
           }
       }
    }

    let calculatedBalance = openingBalance;

    for (const tx of transactions) {
        let amount = tx.amount || 0;
        let isReceipt = false;
        let isPayment = false;
        let isTransferIn = false;
        let isTransferOut = false;

        // Try to classify
        if (tx.debit_or_credit === 'debit') {
            if (tx.transaction_type === 'transfer_fund') isTransferIn = true;
            else isReceipt = true;
        } else if (tx.debit_or_credit === 'credit') {
            if (tx.transaction_type === 'transfer_fund') isTransferOut = true;
            else isPayment = true;
        } else {
            unknown++;
        }

        if (isReceipt) { calculatedBalance += amount; receipts += amount; }
        if (isPayment) { calculatedBalance -= amount; payments += amount; }
        if (isTransferIn) { calculatedBalance += amount; transferIn += amount; }
        if (isTransferOut) { calculatedBalance -= amount; transferOut += amount; }

        if (tx.running_balance !== undefined) {
            let diff = Math.abs(calculatedBalance - tx.running_balance);
            if (diff > 0.01) {
                console.log(`Mismatch at ${tx.date} ID ${tx.transaction_id} Type ${tx.transaction_type} D/C ${tx.debit_or_credit}: Calc ${calculatedBalance} vs Source ${tx.running_balance}`);
                // Do not blindly sync, let it compound to see scale of failure
                // calculatedBalance = tx.running_balance;
            }
        }

        if (calculatedBalance < lowestBalance) {
            lowestBalance = calculatedBalance;
        }
        if (calculatedBalance < 0) {
            negativeTransactions++;
        }
    }

    console.log(`Opening Balance: ${openingBalance}`);
    console.log(`Receipts: ${receipts}`);
    console.log(`Payments: ${payments}`);
    console.log(`Transfers In: ${transferIn}`);
    console.log(`Transfers Out: ${transferOut}`);
    console.log(`Unknown: ${unknown}`);
    console.log(`Final Calculated Balance: ${calculatedBalance}`);
    if (transactions.length > 0) {
        console.log(`Final Source Balance: ${transactions[transactions.length - 1].running_balance}`);
    }

  } catch (err) {
    console.error(err);
  }
}

main();
