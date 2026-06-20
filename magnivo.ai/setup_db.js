const { Client } = require('pg');
const client = new Client({
    connectionString: 'postgresql://postgres:SSKappu@123@db.xhjxpesdvcrensccdydh.supabase.co:5432/postgres'
});

async function runUpdates() {
    await client.connect();
    try {
        // Add columns to leads if they don't exist
        await client.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'New'`);
        await client.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_person TEXT`);

        // Check for a default org
        const res = await client.query('SELECT id FROM organizations LIMIT 1');
        if (res.rows.length === 0) {
            await client.query(`INSERT INTO organizations (name) VALUES ('ApexAI Demo Org')`);
            console.log('Created Default Org');
        } else {
            console.log('Org Exists');
        }

        const fs = require('fs');
        const path = require('path');
        const v2Sql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20240403000000_v2_schema_extensions.sql'), 'utf8');
        await client.query(v2Sql);

        const relationsSql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20240404000000_activity_logs_relations.sql'), 'utf8');
        await client.query(relationsSql);

        const tasksRelationsSql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20240405000000_tasks_relations.sql'), 'utf8');
        await client.query(tasksRelationsSql);

        const realtimeSql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20240406000000_enable_realtime.sql'), 'utf8');
        await client.query(realtimeSql);

        const notificationsSql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20240408000000_notifications_system.sql'), 'utf8');
        await client.query(notificationsSql);

        const automationSql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20240417000000_automation_flows.sql'), 'utf8');
        await client.query(automationSql);

        console.log('Applied V2 Schema, Relations, Realtime, Notifications, and Automation system successfully.');

    } catch (e) { console.error(e) }
    await client.end();
}
runUpdates();
