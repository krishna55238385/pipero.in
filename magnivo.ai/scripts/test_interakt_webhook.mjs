import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const webhookUrl = 'http://localhost:3000/api/webhooks/interakt';
const secret = process.env.INTERAKT_WEBHOOK_SECRET;

const testPayload = {
    "type": "message_received",
    "data": {
        "customer": {
            "phone_number": "919876543210",
            "full_name": "Test WhatsApp User"
        },
        "message": {
            "id": "test-msg-" + Date.now(),
            "message_text": "Hello from WhatsApp test script!"
        }
    }
};

async function testWebhook() {
    console.log('Sending test webhook to:', webhookUrl);
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-interakt-signature': secret || ''
            },
            body: JSON.stringify(testPayload)
        });
        const result = await response.json();
        console.log('Response Status:', response.status);
        console.log('Response Body:', result);
    } catch (error) {
        console.error('Test failed:', error.message);
        console.log('Make sure your local server is running on port 3000 (npm run dev)');
    }
}

testWebhook();
