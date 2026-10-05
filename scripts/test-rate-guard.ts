import { test } from 'node:test';
import assert from 'node:assert';

function checkRateGuard(soRateStr: string | null, poRateStr: string | null, uomMatch: boolean, isMapped: boolean, isAmbiguous: boolean) {
    if (!isMapped || isAmbiguous) return { status: 'CANNOT_DETERMINE' };
    if (!uomMatch) return { status: 'CANNOT_DETERMINE' };
    if (soRateStr === null || poRateStr === null) return { status: 'CANNOT_DETERMINE' };

    const soRate = Number(soRateStr);
    const poRate = Number(poRateStr);

    const roundedSoRate = Math.round(soRate * 1000) / 1000;
    const roundedPoRate = Math.round(poRate * 1000) / 1000;

    if (roundedSoRate >= roundedPoRate) {
        return { status: 'OK' };
    } else {
        const premiumAmount = roundedPoRate - roundedSoRate;
        const premiumPercentage = roundedSoRate > 0 ? (premiumAmount / roundedSoRate) * 100 : null;
        return { 
            status: 'ALERT',
            premiumAmount: Math.round(premiumAmount * 1000) / 1000,
            premiumPercentage 
        };
    }
}

test('Rate Guard Matrix Tests', async (t) => {
    // 1. SO 100 / PO 80 -> OK
    assert.strictEqual(checkRateGuard("100", "80", true, true, false).status, "OK");

    // 2. SO 100 / PO 100 -> OK
    assert.strictEqual(checkRateGuard("100", "100", true, true, false).status, "OK");

    // 3. SO 100 / PO 120 -> ALERT, Premium 20, % 20
    const res3 = checkRateGuard("100", "120", true, true, false);
    assert.strictEqual(res3.status, "ALERT");
    assert.strictEqual(res3.premiumAmount, 20);
    assert.strictEqual(res3.premiumPercentage, 20);

    // 4. SO 100 / PO 100.01 -> ALERT
    assert.strictEqual(checkRateGuard("100", "100.01", true, true, false).status, "ALERT");

    // 5. SO 100 / PO 99.999 floating representation -> OK (if we parse properly it shouldn't false alert, wait: 100 >= 99.999 is OK)
    // Wait, PO=99.9994, PO=100.0004
    assert.strictEqual(checkRateGuard("100", "100.0004", true, true, false).status, "OK"); // rounds to 100

    // 6. missing SO rate
    assert.strictEqual(checkRateGuard(null, "100", true, true, false).status, "CANNOT_DETERMINE");

    // 7. missing PO rate
    assert.strictEqual(checkRateGuard("100", null, true, true, false).status, "CANNOT_DETERMINE");

    // 8. unmapped
    assert.strictEqual(checkRateGuard("100", "100", true, false, false).status, "CANNOT_DETERMINE");

    // 9. ambiguous
    assert.strictEqual(checkRateGuard("100", "100", true, true, true).status, "CANNOT_DETERMINE");

    // 10/11. UOM evidence missing / incompatible -> CANNOT_DETERMINE
    assert.strictEqual(checkRateGuard("100", "120", false, true, false).status, "CANNOT_DETERMINE");
});
