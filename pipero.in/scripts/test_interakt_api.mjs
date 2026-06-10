import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;

async function testEndpoint() {
    const url = 'https://api.interakt.ai/v1/public/get_messages/?limit=10';
    console.log('Testing endpoint:', url);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${INTERAKT_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    console.log('Status:', response.status);
    const text = await response.text();
    console.log('Response:', text);
}

testEndpoint();
