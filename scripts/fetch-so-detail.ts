import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import fs from "fs";

async function fetchSO() {
  const token = await getValidAccessToken();
  const soId = "3166667000016441024";
  const url = `https://www.zohoapis.in/books/v3/salesorders/${soId}?organization_id=774390949`;

  const response = await fetch(url, {
    headers: {
      "Authorization": `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    console.error("Failed to fetch", response.status, await response.text());
    return;
  }
  const data = await response.json();
  fs.writeFileSync("scratch/so_detail.json", JSON.stringify(data, null, 2));
  console.log("Wrote to scratch/so_detail.json");
}

fetchSO();
