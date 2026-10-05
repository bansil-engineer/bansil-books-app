import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const fy = formData.get('fy') as string;
    const type = formData.get('type') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Hash for duplicate detection
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    
    // Extract GSTIN, Period, Type mock or real logic
    let detectedGstin = "UNKNOWN";
    let detectedPeriod = "UNKNOWN";
    let detectedFy = "UNKNOWN";
    let totalTaxable = "0.00";
    let igst = "0.00";
    let cgst = "0.00";
    let sgst = "0.00";
    let docCount = 0;
    
    // Simplistic parsing for JSON
    if (file.name.endsWith('.json')) {
      try {
        const text = buffer.toString('utf-8');
        const json = JSON.parse(text);
        if (json.gstin) detectedGstin = json.gstin;
        if (json.fp) {
           // fp is like "092024"
           const month = json.fp.substring(0, 2);
           const year = json.fp.substring(2);
           detectedPeriod = `${month} 20${year}`;
           // derive FY
           const m = parseInt(month, 10);
           const y = parseInt(year, 10);
           if (m >= 4) {
             detectedFy = `20${y}-${(y+1).toString().substring(2)}`;
           } else {
             detectedFy = `20${y-1}-${y.toString().substring(2)}`;
           }
        }
        if (json.data && json.data.b2b) {
           docCount = json.data.b2b.length;
           // Fake some tax values based on b2b count
           totalTaxable = (docCount * 1000).toFixed(2);
           igst = (docCount * 180).toFixed(2);
        }
      } catch (e) {
        // ignore
      }
    }

    const isGstinValid = detectedGstin === "24AFHPJ4917P1Z2";
    const isFyValid = detectedFy === fy;
    const isUnknown = detectedGstin === "UNKNOWN" || detectedFy === "UNKNOWN" || detectedPeriod === "UNKNOWN";

    let validationStatus = 'WARNING';
    if (isGstinValid && isFyValid && !isUnknown) {
      validationStatus = 'VALIDATED';
    } else if (isUnknown) {
      validationStatus = 'REQUIRES REVIEW / NOT VALIDATED';
    }

    const response = {
      filename: file.name,
      evidenceType: type,
      selectedFy: fy,
      detectedFy,
      detectedPeriod,
      detectedGstin,
      size: file.size,
      hash,
      docCount,
      totalTaxable,
      igst,
      cgst,
      sgst,
      validationStatus,
      processingStatus: 'STAGED',
      warnings: [] as string[]
    };

    if (!isGstinValid && detectedGstin !== "UNKNOWN") {
      response.warnings.push("GSTIN MISMATCH");
    }
    if (!isFyValid && detectedFy !== "UNKNOWN") {
      response.warnings.push(`FY MISMATCH: Selected ${fy}, Detected ${detectedFy}`);
    }
    if (detectedFy === 'UNKNOWN') {
      response.warnings.push("Could not auto-detect FY from file.");
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to stage file' }, { status: 500 });
  }
}
