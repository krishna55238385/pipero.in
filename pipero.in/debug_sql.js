const fs = require('fs');
const { Client } = require('pg');
const client = new Client({
    connectionString: 'postgresql://postgres:SSKappu@123@db.xhjxpesdvcrensccdydh.supabase.co:5432/postgres'
});

async function runTest() {
    await client.connect();
    const sql = fs.readFileSync('supabase/migrations/20240408000000_notifications_system.sql', 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        console.log(`Executing statement ${i + 1}:\n${stmt.substring(0, 100)}...`);
        try {
            await client.query(stmt);
            console.log('Success.');
        } catch (e) {
            console.error(`Error in statement ${i + 1}: ${e.message}`);
            break;
        }
    }
    await client.end();
}
runTest();
